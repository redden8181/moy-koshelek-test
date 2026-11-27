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
  assert.deepEqual(scheduleFromPdfPages([page,continued]),[
    {date:'2026-12-07',amount:145000},{date:'2027-01-07',amount:145000},
  ]);
});

test('PDF import rejects ambiguous payment columns', () => {
  assert.throws(() => scheduleFromPdfPages([[cell('07.12.2026',45,72,65),
    cell('1 000,00',160,72),cell('450,00',230,72)]]), /несколько сумм/);
});
