import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleFromPdfPages} from '../dist/loan-pdf.js';

const cell = (str,x,y,width=42) => ({str,transform:[1,0,0,1,x,y],width});

test('PDF import finds the total payment column across pages', () => {
  const page = [
    cell('Сумма',320,100),cell('платежа',321,90),
    cell('1',12,72,8),cell('07.12.2026',45,72,65),
    cell('1 000,00',160,72),cell('450,00',230,72),cell('1 450,00',320,72),
  ];
  const continued = [cell('07.01.2027',45,72,65),cell('1 050,00',160,72),
    cell('400,00',230,72),cell('1 450,00',320,72)];
  assert.deepEqual(scheduleFromPdfPages([page,continued]).schedule,[
    {date:'2026-12-07',amount:145000},{date:'2027-01-07',amount:145000},
  ]);
});

test('PDF import offers complete column choices when the heading is missing', () => {
  const rows = [[cell('07.12.2026',45,90,65),cell('1 000,00',160,90),cell('1 450,00',230,90),
    cell('07.01.2027',56,72,65),cell('1 025,35',172,72),cell('1 530,20',242,72)]];
  const result = scheduleFromPdfPages(rows);
  assert.equal(result.schedule,undefined);
  assert.deepEqual(result.columns,[{number:1,schedule:[
    {date:'2026-12-07',amount:100000},{date:'2027-01-07',amount:102535},
  ]},{number:2,schedule:[
    {date:'2026-12-07',amount:145000},{date:'2027-01-07',amount:153020},
  ]}]);
});

test('PDF column choices never omit a row with a missing or misaligned amount', () => {
  const rows = [[cell('07.12.2026',45,90,65),cell('900',160,90),cell('1450',230,90),
    cell('07.01.2027',45,72,65),cell('1530',230,72)]];
  assert.deepEqual(scheduleFromPdfPages(rows).columns.map(c=>c.number),[2]);
});
