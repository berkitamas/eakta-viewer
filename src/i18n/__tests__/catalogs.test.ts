import { en } from '../en';
import { hu } from '../hu';

test('English and Hungarian catalogs contain identical keys', () => {
  expect(Object.keys(hu).sort()).toEqual(Object.keys(en).sort());
});

test('catalogs contain the required independent-product disclaimer', () => {
  expect(en.disclaimer).toBe(
    'e-Akta Viewer is an independent application. It is not affiliated with, endorsed by, or supported by Microsec Ltd. or the e‑Szignó service. Validation results are informational and do not replace an official qualified validation report.',
  );
  expect(hu.disclaimer).toBe(
    'Az e-Akta Viewer független alkalmazás. Nem áll kapcsolatban a Microsec Zrt.-vel vagy az e‑Szignó szolgáltatással, és azok nem támogatják vagy hagyták jóvá. Az ellenőrzési eredmények tájékoztató jellegűek, és nem helyettesítik a hivatalos minősített ellenőrzési jelentést.',
  );
});
