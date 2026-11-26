let initialization;
let bindings;
let attempt = 0;

async function initialize() {
  const glue = new URL('./hkid_web_core.js', import.meta.url);
  const binary = new URL('./hkid_web_core_bg.wasm', import.meta.url);
  if (attempt > 0) {
    // Browsers can cache failed module loads for the lifetime of the page.
    glue.searchParams.set('retry', String(attempt));
    binary.searchParams.set('retry', String(attempt));
  }
  attempt++;
  const module = await import(glue.href);
  await module.default({ module_or_path: binary });
  bindings = module;
}

export function loadCore() {
  if (!initialization) {
    initialization = initialize().catch(error => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

export function generateCard(date) {
  const [seed] = crypto.getRandomValues(new BigUint64Array(1));
  return JSON.parse(bindings.generate_card(date, seed));
}

export function validateNumber(input) {
  if (typeof input !== 'string') return { status: 'invalid' };
  return JSON.parse(bindings.validate_number(input));
}
