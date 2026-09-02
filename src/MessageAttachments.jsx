import { useState } from "react";
import { navigateDownloadWindow, reserveDownloadWindow } from "./browser-download.js";

const STATUS_COPY={pending_upload:"Upload pending",pending_scan:"Security scan pending",clean:"Available",rejected:"Blocked by security scan",upload_failed:"Upload failed"};
const formatSize=bytes=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MB`:`${Math.max(1,Math.ceil(bytes/1024))} KB`;

export function MessageAttachments({attachments=[],repository,onError}){
  const [opening,setOpening]=useState(null);if(!attachments.length)return null;
  const open=async item=>{setOpening(item.id);let target;try{target=reserveDownloadWindow();const url=await repository.createAttachmentDownloadUrl(item);navigateDownloadWindow(target,url)}catch(error){try{target?.close?.()}catch{}onError?.(error)}finally{setOpening(null)}};
  return <ul className="message-attachments" aria-label="Message attachments">{attachments.map(item=><li key={item.id}><span><strong>{item.file_name}</strong><small>{formatSize(item.size_bytes)} · {STATUS_COPY[item.status]??"Unavailable"}</small></span>{item.status==="clean"?<button type="button" className="ghost" disabled={opening===item.id} onClick={()=>open(item)}>{opening===item.id?"Preparing…":"Download"}</button>:null}</li>)}</ul>;
}
