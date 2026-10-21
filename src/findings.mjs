// Esquema de hallazgos de una auditoría de configuración de Claude Code.
//
// Es el contrato entre quien audita (un agente de Claude, cc-audit, lo que sea)
// y quien hace algo con los hallazgos (este panel, un creador de tickets). Por
// eso se valida aquí y no se da nada por supuesto: el productor es un modelo de
// lenguaje o una herramienta de terceros.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FINDINGS_PATH = join('.claude', 'audit', 'findings.json');
export const SEVERITIES = ['alta', 'media', 'baja'];
export const CATEGORIES = ['permiso-amplio', 'permiso-saliente', 'permiso-sin-usar',
  'skill-sin-disparador', 'solape', 'prompt-largo', 'hook-sin-limite', 'huerfano', 'otro'];

const isStr = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Valida un informe de hallazgos.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateFindings(doc) {
  const errors = [];
  const bad = (m) => errors.push(m);

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, errors: ['el informe no es un objeto'] };
  }
  if (doc.version !== 1) bad('version debe ser 1');
  if (!isStr(doc.generatedAt) || Number.isNaN(Date.parse(doc.generatedAt))) bad('generatedAt debe ser una fecha ISO');
  if (!isStr(doc.tool)) bad('falta tool');
  if (!isStr(doc.summary)) bad('falta summary');

  const sc = doc.scope;
  if (!sc || typeof sc !== 'object') bad('falta scope');
  else {
    if (!isStr(sc.path)) bad('falta scope.path');
    if (!['repo', 'global'].includes(sc.kind)) bad('scope.kind debe ser repo o global');
  }

  if (!Array.isArray(doc.notChecked)) bad('notChecked debe ser un array (vacío si no hay nada)');
  if (!Array.isArray(doc.findings)) return { ok: false, errors: [...errors, 'findings debe ser un array'] };

  const seen = new Set();
  doc.findings.forEach((f, i) => {
    const at = 'findings[' + i + ']';
    if (!f || typeof f !== 'object') return bad(at + ' no es un objeto');
    if (!isStr(f.id) || !/^[a-z0-9-]+$/.test(f.id)) bad(at + '.id debe ser un slug en minúsculas');
    else if (seen.has(f.id)) bad(at + '.id repetido: ' + f.id);
    else seen.add(f.id);
    if (!SEVERITIES.includes(f.severity)) bad(at + '.severity debe ser ' + SEVERITIES.join('/'));
    if (!CATEGORIES.includes(f.category)) bad(at + '.category desconocida: ' + f.category);
    if (!isStr(f.title)) bad(at + '.title vacío');
    else if (f.title.length > 100) bad(at + '.title pasa de 100 caracteres');
    if (!isStr(f.path)) bad(at + '.path vacío');
    if (f.line !== undefined && (!Number.isInteger(f.line) || f.line < 1)) bad(at + '.line debe ser un entero positivo');
    if (!isStr(f.what)) bad(at + '.what vacío');
    if (!isStr(f.proposal)) bad(at + '.proposal vacío');
    else if (/^revisar\b/i.test(f.proposal.trim())) bad(at + '.proposal no puede ser "revisar": di qué hacer');
    if (f.autofix !== undefined && f.autofix !== null) {
      if (typeof f.autofix !== 'object') bad(at + '.autofix debe ser un objeto o null');
      else {
        if (!['quitar-permiso', 'reemplazar-permiso', 'añadir-timeout'].includes(f.autofix.kind)) {
          bad(at + '.autofix.kind desconocido');
        }
        if (!isStr(f.autofix.file)) bad(at + '.autofix.file vacío');
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

/** Ordena por severidad y, dentro de cada una, deja el orden del productor. */
export function sortFindings(findings) {
  return [...findings].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}

/**
 * Lee el informe de un ámbito, si existe.
 * @returns {{doc: object|null, errors: string[], path: string}}
 */
export function loadFindings(scopePath) {
  const path = join(scopePath, FINDINGS_PATH);
  if (!existsSync(path)) return { doc: null, errors: [], path };
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { doc: null, errors: ['JSON inválido: ' + e.message], path }; }
  const { ok, errors } = validateFindings(parsed);
  return { doc: ok ? parsed : null, errors, path };
}
