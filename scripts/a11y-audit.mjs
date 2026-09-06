import { AxeBuilder } from "@axe-core/playwright";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const origin="http://127.0.0.1:4317";
const server=spawn(process.execPath,["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","4317"],{stdio:"ignore"});

async function waitForServer(){for(let attempt=0;attempt<60;attempt+=1){try{const response=await fetch(origin);if(response.ok)return}catch{}await new Promise((resolve)=>setTimeout(resolve,100))}throw new Error("Accessibility preview server did not start")}

const views=[{name:"overview",label:null},{name:"plan",label:"Learning plan"},{name:"intake",label:"Learner profile"},{name:"educator",label:"Educator demo"}];
const viewports=[{name:"desktop",width:1280,height:900},{name:"zoom-200-equivalent",width:640,height:720},{name:"zoom-400-equivalent",width:320,height:720}];

async function keyboardEvidence(page){
  await page.evaluate(()=>{document.activeElement?.blur?.();document.body.tabIndex=-1;document.body.focus()});
  const visited=[];for(let index=0;index<12;index+=1){await page.keyboard.press("Tab");const state=await page.evaluate(()=>{const node=document.activeElement,style=getComputedStyle(node);return{tag:node?.tagName??null,label:node?.getAttribute?.("aria-label")??node?.textContent?.trim().slice(0,80)??null,outlineWidth:style.outlineWidth,outlineStyle:style.outlineStyle}});visited.push(state)}
  const interactive=visited.filter(item=>["A","BUTTON","INPUT","SELECT","TEXTAREA"].includes(item.tag));const visibleFocus=interactive.every(item=>item.outlineStyle!=="none"&&item.outlineWidth!=="0px");return{visited,interactiveCount:interactive.length,visibleFocus};
}

try{
  await waitForServer(); await mkdir(new URL("../qa/accessibility/",import.meta.url),{recursive:true});
  const browser=await chromium.launch({
    headless:true,
    executablePath:process.env.PLAYWRIGHT_CHROME_PATH
      || (process.platform==="darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined)
      || "/usr/local/bin/google-chrome"
  });
  const results=[];
  for(const viewport of viewports){
    const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},reducedMotion:"reduce"});
    const page=await context.newPage();
    await page.goto(origin,{waitUntil:"networkidle"});
    for(const view of views){
      if(view.label){await page.getByRole("button",{name:view.label,exact:true}).click();await page.waitForTimeout(30)}
      const audit=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
      const layout=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
      const keyboard=await keyboardEvidence(page);results.push({view:view.name,viewport:viewport.name,layout,keyboard,violations:audit.violations.map((item)=>({id:item.id,impact:item.impact,help:item.help,nodes:item.nodes.map((node)=>node.target)}))});
      await page.screenshot({path:new URL(`../qa/accessibility/${view.name}-${viewport.name}.png`,import.meta.url).pathname,fullPage:true});
    }
    await context.close();
  }
  await browser.close();
  const serious=results.flatMap((result)=>result.violations.filter((item)=>["serious","critical"].includes(item.impact)).map((item)=>`${result.view}/${result.viewport}: ${item.id}`));
  const overflow=results.filter((result)=>result.layout.scrollWidth>result.layout.clientWidth).map((result)=>`${result.view}/${result.viewport}: ${result.layout.scrollWidth}>${result.layout.clientWidth}`);
  const keyboardFailures=results.filter(result=>result.keyboard.interactiveCount<3||!result.keyboard.visibleFocus).map(result=>`${result.view}/${result.viewport}: keyboard focus evidence failed`);const report={generatedAt:new Date().toISOString(),standard:"axe WCAG 2 A/AA/2.1 AA",zoomMethod:"Responsive CSS viewport equivalence at 200% (640 CSS px) and 400% (320 CSS px) for a 1280px reference; real browser zoom and VoiceOver remain manual gates.",viewports,results,summary:{seriousOrCritical:serious,horizontalOverflow:overflow,keyboardFocusFailures:keyboardFailures}};
  await writeFile(new URL("../qa/accessibility/report.json",import.meta.url),JSON.stringify(report,null,2));
  if(serious.length||overflow.length||keyboardFailures.length)throw new Error([...serious,...overflow,...keyboardFailures].join("\n"));
  process.stdout.write(`Accessibility audit passed ${results.length} rendered view/viewport combinations.\n`);
} finally { server.kill("SIGTERM"); }
