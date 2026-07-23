const TARGET_ROWS=5000;
const MAX_BYTES=4_500_000;
const LANES=3;
const enc=new TextEncoder();
function row(i){return {name:`Business ${i}`,email:`lead${i}@example.com`,phone:null,website:`https://example${i}.com`,domain:`example${i}.com`,category:'test',location:'Lagos',source:'csv_upload',normalized_key:`email:lead${i}@example.com`,raw:{}};}
function chunks(rows){const out=[];let current=[];let bytes=2;for(const item of rows){const size=enc.encode(JSON.stringify(item)).length+2;if(current.length>=TARGET_ROWS||(current.length>0&&bytes+size>MAX_BYTES)){out.push(current);current=[];bytes=2;}current.push(item);bytes+=size;}if(current.length)out.push(current);return out;}
const rows=Array.from({length:20000},(_,i)=>row(i+1));
const parts=chunks(rows);
const sizes=parts.map(p=>p.length);
if(parts.length!==4||sizes.some(n=>n>5000)) throw new Error(`Unexpected 20k plan: ${JSON.stringify(sizes)}`);
console.log(JSON.stringify({rows:rows.length,chunks:parts.length,chunkSizes:sizes,concurrentLanes:Math.min(LANES,parts.length),networkWaves:Math.ceil(parts.length/LANES)},null,2));
