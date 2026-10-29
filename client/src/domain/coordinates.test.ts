import { describe, expect, it } from 'vitest';
import { coordinateError, coordinatePair, coordinateValue } from './coordinates';

describe('coordinate values', () => {
  it.each([
    ['47.26', 47.26], ['47,26', 47.26], ['−33.8', -33.8],
    [' -180 ', -180], ['+.5', 0.5], ['0', 0], ['90.', 90],
  ])('parses %s', (value, expected) => expect(coordinateValue(String(value))).toBe(expected));
  it.each(['', ' ', 'Minsk', '1e2', 'Infinity', 'NaN', '47,26,11,4', '12abc'])('rejects %s', (value) => {
    expect(coordinateValue(value)).toBeNull();
  });
  it('validates missing values and latitude/longitude limits separately', () => {
    expect(coordinateError('', 'latitude')).toBe('Enter latitude.');
    expect(coordinateError(' ', 'longitude')).toBe('Enter longitude.');
    expect(coordinateError('text', 'latitude')).toBe('Enter a number, for example 47.26.');
    expect(coordinateError('90.01', 'latitude')).toBe('Latitude must be between −90 and 90.');
    expect(coordinateError('-180.01', 'longitude')).toBe('Longitude must be between −180 and 180.');
    for (const value of ['-90', '0', '90']) expect(coordinateError(value, 'latitude')).toBeNull();
    for (const value of ['-180', '0', '180']) expect(coordinateError(value, 'longitude')).toBeNull();
  });
});

describe('coordinate pairs', () => {
  it.each([
    ['47.26, 11.4', ['47.26', '11.4']],
    ['47.26,11.4', ['47.26', '11.4']],
    ['47.26 11.4', ['47.26', '11.4']],
    ['47,26; 11,4', ['47,26', '11,4']],
    ['47,26 11,4', ['47,26', '11,4']],
    ['−33.8\n+151.2', ['-33.8', '+151.2']],
    ['90, 180', ['90', '180']],
    ['0; 0', ['0', '0']],
  ])('splits %s in latitude/longitude order', (value, expected) => {
    expect(coordinatePair(String(value))).toEqual(expected);
  });
  it.each(['47,26', '-33.8', '47.26, 11.4, 1', 'Minsk', '', '47,26,11,4'])('does not split %s', (value) => {
    expect(coordinatePair(value)).toBeNull();
  });
});
