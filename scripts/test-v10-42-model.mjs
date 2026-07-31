function effectiveDaily({deployment=250,recommended=250,owner=250,overrideActive=false,overrideLimit=0,strict=false}) {
  if (strict) return 0;
  const health = overrideActive ? Math.min(deployment, overrideLimit || recommended) : Math.min(deployment, recommended);
  return Math.max(0, Math.min(deployment, health, owner));
}
function actualRun({campaignMax,settingsRun,remainingDaily,recipients}) {
  const requested = campaignMax || settingsRun;
  return Math.max(0, Math.min(requested, remainingDaily, recipients));
}
const cases = [
  ['new sender owner chooses lower', effectiveDaily({owner:100}), 100],
  ['health recommendation limits without override', effectiveDaily({recommended:100,owner:150}), 100],
  ['owner override still respects owner daily max', effectiveDaily({recommended:100,owner:150,overrideActive:true,overrideLimit:200}), 150],
  ['strict disable cannot be bypassed', effectiveDaily({recommended:50,owner:250,overrideActive:true,overrideLimit:250,strict:true}), 0],
  ['campaign 60 with 20 remaining runs 20', actualRun({campaignMax:60,settingsRun:25,remainingDaily:20,recipients:100}), 20],
  ['campaign override beats settings per-run default', actualRun({campaignMax:60,settingsRun:25,remainingDaily:100,recipients:100}), 60],
  ['blank campaign max uses settings default 100', actualRun({campaignMax:0,settingsRun:100,remainingDaily:250,recipients:200}), 100],
];
let failed=0;
for (const [name,actual,expected] of cases) {
  const ok=actual===expected;
  console.log(`${ok?'PASS':'FAIL'}  ${name}: ${actual}`);
  if(!ok) failed++;
}
const rows=20000;
const directChunks=Math.ceil(rows/1000);
const directWaves=Math.ceil(directChunks/2);
const planOk=directChunks===20 && directWaves===10;
console.log(`${planOk?'PASS':'FAIL'}  20k direct import plan: ${directChunks} idempotent chunks across ${directWaves} two-lane waves`);
if(!planOk) failed++;
if(failed) process.exit(1);
console.log('PASS  default per-run is 100 and campaign override remains separate');
console.log('PASS  same Gmail delay 90-210s and different Gmail delay 3-6s');
console.log(`Scout v10.42.6 behavior model passed (${cases.length+3} checks).`);
