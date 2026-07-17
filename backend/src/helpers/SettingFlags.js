/**
 * Normalize stored setting flags. Accepts real booleans and common string/number forms.
 */
function isEnabledFlag(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  return defaultValue;
}

module.exports = { isEnabledFlag };
