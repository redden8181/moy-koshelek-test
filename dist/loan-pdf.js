import {parseLoanSchedule} from './core.js?v=15';

const datePattern = /^(?:\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2})$/;
const amountPattern = /^(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.]\d{1,2})?(?:\s*(?:₽|руб\.?|RUB))?$/i;
const partialHeader = /основн(?:ой|ого)\s+долг|процент|комисси|principal|interest/i;
const totalHeader = /(?:итого\s+к\s+оплате|полная\s+сумма\s+платежа|сумма\s+(?:ежемесячного\s+)?плат[её]жа|(?:ежемесячный|общий|аннуитетный|плановый)\s+плат[её]ж|payment\s+amount)/i;

function toRows(items) {
  const lines = [];
  for (const item of items) {
    if (!item.str?.trim() || !item.transform) continue;
    const [, , , , x, y] = item.transform;
    let line = lines.find(row => Math.abs(row.y - y) <= 2);
    if (!line) { line = {y, cells:[]}; lines.push(line); }
    line.cells.push({x, right:x + item.width, text:item.str.trim().replace(/\s+/g,' ')});
  }
  return lines.sort((a,b) => b.y-a.y).map(({cells}) => {
    const merged = [];
    for (const cell of cells.sort((a,b) => a.x-b.x)) {
      const previous = merged.at(-1);
      if (previous && cell.x-previous.right <= 4) {
        previous.text += ' ' + cell.text;
        previous.right = Math.max(previous.right,cell.right);
      } else {
        merged.push({...cell});
      }
    }
    return merged;
  });
}

function amountValue(text) {
  const raw = text.replace(/\s*(?:₽|руб\.?|RUB)$/i,'').replace(/\s/g,'');
  return raw.includes(',') ? raw.replace(/\./g,'') : raw.replace(/\.(?=\d{3}(?:\.|$))/g,'');
}

export function scheduleFromPdfPages(pages) {
  let totalColumn;
  const found = new Map();
  for (const items of pages) {
    const rows = toRows(items);
    for (let i=0; i<rows.length; i++) {
      const cells = rows[i];
      const next = rows[i+1] || [];
      const header = cells.find((cell,index) => {
        if (totalHeader.test(cell.text) && !partialHeader.test(cell.text)) return true;
        const below = next.find(other => Math.abs(other.x-cell.x)<15);
        const adjacent = cells[index+1];
        return (below && totalHeader.test(cell.text+' '+below.text) && !partialHeader.test(cell.text+' '+below.text)) ||
          (adjacent && adjacent.x-cell.right<18 && totalHeader.test(cell.text+' '+adjacent.text) && !partialHeader.test(cell.text+' '+adjacent.text));
      });
      if (header) totalColumn = {left:header.x, right:header.right};
      const index = cells.findIndex(cell => datePattern.test(cell.text));
      if (index < 0 || !cells.slice(0,index).every(cell => /^\d{1,4}$/.test(cell.text))) continue;
      const candidates = cells.slice(index+1).filter(cell => amountPattern.test(cell.text));
      if (!candidates.length) continue;
      let amount = candidates[0];
      if (candidates.length > 1) {
        if (!totalColumn) throw Error('В PDF несколько сумм на дату, а колонка платежа не распознана. Используйте CSV.');
        const midpoint = cell => (cell.x + cell.right)/2;
        const distance = cell => Math.abs(midpoint(cell)-((totalColumn.left+totalColumn.right)/2));
        candidates.sort((a,b)=>distance(a)-distance(b));
        if (distance(candidates[1])-distance(candidates[0])<8 || distance(candidates[0])>50) {
          throw Error('Не удалось однозначно определить сумму платежа в PDF. Используйте CSV.');
        }
        amount = candidates[0];
      }
      const date = cells[index].text.replaceAll('/','.');
      const value = amountValue(amount.text);
      if (found.has(date) && found.get(date)!==value) throw Error('В PDF найдены разные суммы на одну дату');
      found.set(date,value);
    }
  }
  if (!found.size) throw Error('В PDF не найден текстовый график платежей. Сканы и фото не распознаются.');
  return parseLoanSchedule('Дата;Сумма\n'+[...found].map(([date,amount])=>date+';'+amount).join('\n'));
}

export async function readPdfSchedule(bytes) {
  let pdf;
  try {
    pdf = await import('./vendor/pdf.min.mjs');
  } catch {
    throw Error('Не удалось загрузить модуль PDF. Откройте приложение с интернетом и попробуйте снова.');
  }
  pdf.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs',import.meta.url).href;
  const task = pdf.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true,useWasm:false,
    cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,
    standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href});
  try {
    const document = await task.promise;
    if (document.numPages>80) throw Error('График может содержать до 80 страниц');
    const pages = [];
    for (let i=1;i<=document.numPages;i++) {
      const page = await document.getPage(i);
      pages.push((await page.getTextContent()).items);
    }
    return scheduleFromPdfPages(pages);
  } catch (error) {
    if (error.name==='PasswordException') throw Error('PDF защищён паролем. Загрузите копию без пароля.');
    throw error;
  } finally {
    await task.destroy().catch(()=>{});
  }
}
