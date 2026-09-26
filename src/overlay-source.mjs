import { createOverlayModel } from './overlay/model.mjs';
import { createCatalogSurface } from './overlay/catalog.mjs';
import { createOverlayClassifier } from './overlay/classifier.mjs';
import { createOverlayTranslator } from './overlay/translator.mjs';
import { createOverlayRuntime, installCopilotChinese } from './overlay/runtime.mjs';

// The WebView is not allowed to import local project modules. Serialize the
// self-contained factory functions into one browser script at launch/test time.
// This keeps source modular without introducing a bundler or generated artifact.
const overlayFunctions = [
  createOverlayModel,
  createCatalogSurface,
  createOverlayClassifier,
  createOverlayTranslator,
  createOverlayRuntime,
  installCopilotChinese
];

export function loadOverlaySource() {
  return `/* Generated in memory from src/overlay/*.mjs. */\n${overlayFunctions.map(fn => fn.toString()).join('\n\n')}\n`;
}

export function overlaySourceFunctions() {
  return [...overlayFunctions];
}
