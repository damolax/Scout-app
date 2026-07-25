#!/usr/bin/env bash
set +e

echo "Checking GitHub main package version..."
GITHUB_PACKAGE="$(curl -fsSL --max-time 20 https://raw.githubusercontent.com/damolax/Scout-app/main/package.json 2>/dev/null)"
if [ -n "$GITHUB_PACKAGE" ]; then
  printf '%s' "$GITHUB_PACKAGE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);console.log("GitHub package version:",j.version||"missing")}catch{console.log("GitHub package.json could not be parsed")}})'
else
  echo "GitHub package.json could not be fetched."
fi

echo
echo "Checking live Vercel health..."
HEALTH="$(curl -fsSL --max-time 20 https://scout-app-oyeola.vercel.app/api/health 2>/dev/null)"
if [ -n "$HEALTH" ]; then
  printf '%s' "$HEALTH" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);console.log(JSON.stringify({version:j.version,build:j.build,bulkImportReady:j.bulkImportReady,schemaContract:j?.schema?.contractVersion},null,2))}catch{console.log("Health response could not be parsed")}})'
else
  echo "Live health endpoint could not be fetched."
fi

echo
read -r -p 'Press Enter to return to the Git Bash prompt... '
