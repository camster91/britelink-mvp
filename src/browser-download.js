export function reserveDownloadWindow(openWindow=globalThis.open){
 const target=openWindow?.("about:blank","_blank");
 if(!target)throw new Error("Your browser blocked the download window. Allow pop-ups for BriteLink and try again.");
 try{target.opener=null}catch{}
 return target;
}

export function navigateDownloadWindow(target,url){
 if(!target||!url)throw new Error("Attachment download link was not created");
 if(typeof target.location?.replace==="function")target.location.replace(url);else target.location=url;
}

// Save generated text (CSV, ICS) on this device without a server round trip. The link is attached
// to the page and the object URL revoked a moment later: some Firefox and Safari versions start
// nothing for a detached link, or for a URL revoked in the same task as the click.
export function downloadTextFile(filename, contents, type, doc = globalThis.document, urls = globalThis.URL, later = (run) => setTimeout(run, 1000)) {
 const url = urls.createObjectURL(new Blob([contents], { type }));
 const anchor = doc.createElement("a");
 anchor.href = url;
 anchor.download = filename;
 anchor.style && (anchor.style.display = "none");
 doc.body?.appendChild(anchor);
 try {
  anchor.click();
 } finally {
  later(() => {
   anchor.remove?.();
   urls.revokeObjectURL(url);
  });
 }
}
