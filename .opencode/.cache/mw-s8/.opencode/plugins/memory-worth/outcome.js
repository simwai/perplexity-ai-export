"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectOutcome = detectOutcome;
exports.classifyOutcome = classifyOutcome;
exports.isOutcomeSignal = isOutcomeSignal;
const SUCCESS_SIGNALS = [
    /\bfixed\b/i, /\bpassing\b/i, /\bworks\b(?:\s+now)?\b/i, /\bresolved\b/i,
    /\bdone\b/i, /\bcompleted?\b/i, /\bsuccess\b/i, /\bworking\b/i, /\bmerged?\b/i,
    /\bverified\b/i, /\bconfirmed\b/i, /\bclosed?\b/i, /\bshipped?\b/i,
];
const FAILURE_SIGNALS = [
    /\bfail(?:s|ed|ure)?\b/i, /\bbroken\b/i, /\berror\b/i, /\bregression\b/i,
    /\bnot\s+working\b/i, /\bstill\s+broken\b/i, /\bdoesn'?t\s+work\b/i,
    /\bcrashes?\b/i, /\btimeout\b/i, /\bincorrect\b/i, /\bbug\b/i,
];
function detectOutcome(text) {
    const hasSuccess = SUCCESS_SIGNALS.some((re) => re.test(text));
    const hasFailure = FAILURE_SIGNALS.some((re) => re.test(text));
    if (hasSuccess && !hasFailure)
        return true;
    if (hasFailure && !hasSuccess)
        return false;
    return null;
}
function classifyOutcome(text) {
    const outcome = detectOutcome(text);
    if (outcome === true)
        return "success";
    if (outcome === false)
        return "failure";
    return "inconclusive";
}
function isOutcomeSignal(text) {
    return detectOutcome(text) !== null;
}
