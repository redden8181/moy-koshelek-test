import {parse,parseLoanSchedule} from './core.js?v=15';

const datePattern = /^(?:\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2})$/;
const amountPattern = /^(?:\d{1,3}(?:[ ,.]\d{3})+|\d+)(?:[,.]\d{1,2})?(?:\s*(?:₽|руб\.?|RUB))?$/i;
const partialHeader = /основн(?:ой|ого)\s+долг|процент|комисси|principal|interest/i;
const isTotalHeading = text => totalHeader.test(text) && !partialHeader.test(text) && !/\s(?:в|на|по|из)$/i.test(text);
const totalHeader = /(?:итого\s+к\s+оплате|общая\s+сумма\s+погашения|полная\s+сумма\s+платежа|сумма\s+(?:ежемесячного\s+)?плат[её]жа|(?:ежемесячный|общий|аннуитетный|плановый|регулярный)\s+плат[её]ж|payment\s+amount)/i;

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
  const decimals = raw.match(/[,.](\d{1,2})$/);
  const integer = decimals ? raw.slice(0,decimals.index) : raw;
  return integer.replace(/[,.]/g,'') + (decimals ? '.'+decimals[1] : '');
}

function paymentRows(pages) {
  let totalColumn;
  const result = [];
  for (const items of pages) {
    const rows = toRows(items);
    for (let i=0; i<rows.length; i++) {
      const cells = rows[i];
      const below = rows.slice(i+1,i+4).flat();
      const header = cells.find((cell,index) => {
        if (isTotalHeading(cell.text)) return true;
        const adjacent = cells[index+1];
        return below.some(other=>Math.abs(other.x-cell.x)<15&&isTotalHeading(cell.text+' '+other.text)) ||
          (adjacent && adjacent.x-cell.right<18 && isTotalHeading(cell.text+' '+adjacent.text));
      });
      if (header) totalColumn = header;
      const dateIndex = cells.findIndex(cell => datePattern.test(cell.text));
      if (dateIndex < 0 || !cells.slice(0,dateIndex).every(cell => /^\d{1,4}$/.test(cell.text))) continue;
      const date = cells[dateIndex];
      const candidates = cells.slice(dateIndex+1).filter(cell => amountPattern.test(cell.text));
      if (candidates.length) result.push({date:date.text.replaceAll('/','.'), origin:date.x, ordinal:dateIndex?cells[dateIndex-1].text:null, candidates, totalColumn});
    }
  }
  return result;
}

const midpoint = cell => (cell.x + cell.right)/2;
function closestCell(cells, distance, limit) {
  const ranked = cells.map(cell => ({cell, distance:distance(cell)})).sort((a,b) => a.distance-b.distance);
  if (!ranked.length || ranked[0].distance>limit ||
      (ranked[1] && ranked[1].distance-ranked[0].distance<8)) return null;
  return ranked[0].cell;
}

function readSchedule(rows, selectCell) {
  const totals = new Map();
  const seen = new Map();
  for (const row of rows) {
    const cell = selectCell(row);
    if (!cell) return null;
    const value = amountValue(cell.text);
    const amount = Number(value)===0?0:parse(value);
    if (amount===null) return null;
    const identity = row.date+':'+(row.ordinal??'');
    if (seen.has(identity)) {
      if (seen.get(identity)!==amount) return null;
      continue;
    }
    seen.set(identity,amount);
    totals.set(row.date,(totals.get(row.date)||0)+amount);
  }
  const lines = [...totals].filter(([, amount])=>amount>0)
    .map(([date,amount])=>[date,(amount/100).toFixed(2)]);
  if (!lines.length) return null;
  try {
    return parseLoanSchedule('Дата;Сумма\n'+lines.map(([date,amount])=>date+';'+amount).join('\n'));
  } catch {
    return null;
  }
}

export function scheduleFromPdfPages(pages) {
  const rows = paymentRows(pages);
  if (!rows.length) throw Error('В PDF не найден текстовый график платежей. Сканы и фото не распознаются.');
  const template = rows.reduce((first,row)=>row.candidates.length>first.candidates.length?row:first);
  if (template.candidates.length===1) {
    const schedule = readSchedule(rows,row=>row.candidates[0]);
    if (schedule) return {schedule};
  } else {
    const schedule = readSchedule(rows,row=>row.totalColumn
      ? closestCell(row.candidates,cell=>Math.abs(midpoint(cell)-midpoint(row.totalColumn)),32)
      : null);
    if (schedule) return {schedule};

    const columns = template.candidates.flatMap((column,index)=>{
      const left = column.x-template.origin;
      const right = column.right-template.origin;
      const schedule = readSchedule(rows,row=>closestCell(row.candidates,cell=>Math.min(
        Math.abs(cell.x-row.origin-left),
        Math.abs(cell.right-row.origin-right)
      ),16));
      return schedule ? [{number:index+1,schedule}] : [];
    });
    if (columns.length) return {columns};
  }
  throw Error('Не удалось собрать полный график из PDF. Проверьте, что в файле есть таблица с датами и суммами.');
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
