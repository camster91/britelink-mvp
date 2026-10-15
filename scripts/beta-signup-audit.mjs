// Beta signup journey: nothing is provisioned before the family follows the link (migration 041),
// the details they typed come back as metadata and provision once, and the no-metadata and failure
// paths keep the form usable and accessible.
import { AxeBuilder } from "@axe-core/playwright";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { chromeLaunchOptions } from "./resolve-chrome.mjs";

const origin="http://127.0.0.1:4322";
const server=spawn(process.execPath,["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","4322","--mode","test"],{stdio:"ignore",env:{...process.env,VITE_SUPABASE_URL:"",VITE_SUPABASE_ANON_KEY:""}});
async function waitForServer(){for(let attempt=0;attempt<60;attempt+=1){try{if((await fetch(origin)).ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}throw new Error("Beta signup QA server did not start")}
const calls=(page)=>page.evaluate(()=>globalThis.betaSignupQaState.calls);
async function axe(page,label){const {violations}=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();if(violations.length)throw new Error(`${label}: ${violations.map(v=>`${v.id} (${v.nodes.length})`).join(", ")}`)}

try{
  await waitForServer();
  const browser=await chromium.launch(chromeLaunchOptions());
  for(const viewport of [{width:1280,height:900},{width:375,height:800}]){
    const context=await browser.newContext({viewport,reducedMotion:"reduce"});
    const page=await context.newPage();
    const open=(mode)=>page.goto(`${origin}/qa/beta-signup-harness.html?mode=${mode}`,{waitUntil:"networkidle"});

    // 1. Signed out: joining only sends the link.
    await open("signin");
    await page.getByRole("button",{name:"New here? Join the free beta"}).click();
    await page.getByLabel("Email address").fill("family@example.test");
    await page.getByLabel("Your child's first name").fill("Riley");
    await page.getByLabel("Grade or level").fill("Grade 3");
    await page.getByRole("button",{name:"Join the free beta"}).click();
    await page.getByText("Check your email for a secure sign-in link.",{exact:false}).waitFor();
    const signin=await calls(page);
    if(signin.some(([name])=>name==="provisionBetaHousehold"))throw new Error("a household was provisioned before the sign-in link was followed");
    const join=signin.find(([name])=>name==="joinBeta");
    if(!join||join[2]?.learnerName!=="Riley"||join[2]?.learnerGrade!=="Grade 3")throw new Error(`joinBeta did not carry the learner details: ${JSON.stringify(signin)}`);
    await axe(page,"join form");

    // 2. Back from the link with metadata: provisions once, lands in the workspace.
    await open("auto");
    await page.getByRole("heading",{name:/Riley/}).first().waitFor();
    const auto=(await calls(page)).filter(([name])=>name==="provisionBetaHousehold");
    if(auto.length!==1||auto[0][1].learnerName!=="Riley")throw new Error(`expected exactly one provisioning call, got ${JSON.stringify(auto)}`);

    // 3. No metadata: form validates, names the fields, focuses the first invalid one.
    await open("manual");
    await page.getByRole("heading",{name:"Set up your household"}).waitFor();
    if((await calls(page)).some(([name])=>name==="provisionBetaHousehold"))throw new Error("provisioned without any learner details");
    await page.getByRole("button",{name:"Start the free beta"}).click();
    await page.getByRole("alert").getByText("your child's first name and their grade or level",{exact:false}).waitFor();
    if(await page.getByLabel("Your child's first name").getAttribute("aria-invalid")!=="true")throw new Error("missing name is not marked aria-invalid");
    if(!await page.getByLabel("Your child's first name").evaluate(el=>el===document.activeElement))throw new Error("focus did not move to the first invalid field");
    await axe(page,"setup form with errors");
    for(const name of ["Start the free beta","Sign out"]){const box=await page.getByRole("button",{name}).boundingBox();if(box.height<44)throw new Error(`${name} is ${box.height}px tall`)}
    await page.getByLabel("Your child's first name").fill("Riley");
    await page.getByLabel("Grade or level").fill("Grade 3");
    await page.getByRole("button",{name:"Start the free beta"}).click();
    await page.getByRole("heading",{name:/Riley/}).first().waitFor();

    // 4. Provisioning fails once: the error is announced and the prefilled form allows a retry.
    await open("fail");
    await page.getByRole("alert").getByText("temporarily unavailable",{exact:false}).waitFor();
    if(await page.getByLabel("Your child's first name").inputValue()!=="Riley")throw new Error("the form lost the metadata after a failure");
    await axe(page,"setup failure");
    await page.getByRole("button",{name:"Start the free beta"}).click();
    await page.getByRole("heading",{name:/Riley/}).first().waitFor();

    // 5. An educator with no family yet (migration 061): told to wait, never offered family setup.
    await open("staff");
    await page.getByRole("heading",{name:"You're on the BriteLink staff team"}).waitFor();
    if(await page.getByRole("heading",{name:"Set up your household"}).count())throw new Error("a staff educator was offered family setup");
    if(await page.title()!=="Waiting for your first family · BriteLink")throw new Error(`staff waiting title is "${await page.title()}"`);
    await axe(page,"staff waiting");
    for(const name of ["Check again","Sign out","Save name"]){const box=await page.getByRole("button",{name}).boundingBox();if(box.height<44)throw new Error(`${name} is ${box.height}px tall`)}
    await page.getByLabel("Your name, shown to other staff").fill("Ms. Rivera");
    await page.getByRole("button",{name:"Save name"}).click();
    await page.getByText("Saved. Other staff now see this name.").waitFor();
    const before=(await calls(page)).filter(([name])=>name==="listMemberships").length;
    await page.getByRole("button",{name:"Check again"}).click();
    await page.getByRole("heading",{name:"You're on the BriteLink staff team"}).waitFor();
    const staffCalls=await calls(page);
    if(staffCalls.filter(([name])=>name==="listMemberships").length<=before)throw new Error("Check again did not reload");
    if(staffCalls.some(([name])=>name==="provisionBetaHousehold"))throw new Error("a staff educator provisioned a household");
    await context.close();
  }
  await browser.close();
  console.log("Beta signup audit passed at 1280px and 375px: no pre-link provisioning, one-shot metadata provisioning, accessible validation and retry, staff waiting screen.");
}finally{server.kill()}
