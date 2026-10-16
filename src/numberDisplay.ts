import type { PropertyNumberFieldProps } from '@weasel-js/ui/components/Properties';

type Display = NonNullable<PropertyNumberFieldProps['display']>;

/** A number shown at a fixed count of decimals, trailing zeros kept so a
 *  column of them lines up. Panel lengths use one: 0.035mm, finer than a
 *  180dpi dot. */
export function fixedDecimals(places: number): Display {
  return { kind: 'decimal', places, grouping: false };
}

export const PT_DISPLAY = fixedDecimals(1);
