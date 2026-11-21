export const canonicalPhase=phase=>phase==='Onboarding'?'Induction':['Final Review & Confirmation','Final Feedback & Confirmation'].includes(phase)?'Final Feedback':phase;
export const samePhase=(a,b)=>canonicalPhase(a)===canonicalPhase(b);
export const phaseLabel=phase=>canonicalPhase(phase)==='Induction'?'Induction & Onboarding':canonicalPhase(phase)==='Final Feedback'?'Final Feedback & Confirmation':phase;
export const administrativePhase=phase=>['Final Feedback','Onboard Final Email','Asset Allotment'].includes(canonicalPhase(phase));
export function orderedPhases(phases){const unique=[...new Set(phases.map(canonicalPhase))];return [...unique.filter(p=>!['Final Feedback','Onboard Final Email','Asset Allotment'].includes(p)),...['Final Feedback','Onboard Final Email','Asset Allotment'].filter(p=>unique.includes(p))];}
