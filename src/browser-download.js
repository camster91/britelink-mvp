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
