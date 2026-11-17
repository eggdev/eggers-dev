// `bun test lib`: how a phone number is printed on a resume (rule 11). The numbers are invented.
import { expect, test } from 'bun:test';
import './scratch.ts';
import { contactLine, phoneText, withHeader } from './person.ts';

test('a ten-digit North American number is printed as (XXX) XXX-XXXX, with a leading 1 dropped', () => {
  for (const typed of ['2185550142', '218-555-0142', '218.555.0142', '(218) 555-0142', '218 555 0142', '1 218 555 0142', '+1 (218) 555-0142', '+12185550142', '1-218-555-0142']) expect(phoneText(typed)).toBe('(218) 555-0142');
});

test('any other number is printed as it was entered', () => {
  for (const typed of ['+44 20 7946 0958', '+49 30 901820', '555-0142', '218-555-0142 x12', '218-555-0142 ext. 7', '+61 2 5550 1420', '0218555014', '1185550142', '']) expect(phoneText(typed)).toBe(typed);
  expect(phoneText('  +44 20 7946 0958 ')).toBe('+44 20 7946 0958');
});

test('the contact line and the header use it', () => {
  const p = { name: 'Avery Lindqvist', location: 'Duluth, MN', email: 'avery@lindqvist.example', phone: '12185550142', website: 'https://www.lindqvist.example/', github: '', linkedin: '' };
  expect(contactLine(p)).toBe('Duluth, MN · avery@lindqvist.example · (218) 555-0142 · lindqvist.example');
  expect(withHeader('# A. L.\nold line 218-555-0142\n\n## Summary\nEngineer.', p).split('\n').slice(0, 2)).toEqual(['# Avery Lindqvist', 'Duluth, MN · avery@lindqvist.example · (218) 555-0142 · lindqvist.example']);
});
