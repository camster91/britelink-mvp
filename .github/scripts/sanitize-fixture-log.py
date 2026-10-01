"""Emit disposable CI failure diagnostics without credentials or link tokens."""
import re,sys
from pathlib import Path
text=Path(sys.argv[1]).read_text(errors='replace')
for filename in ['supabase/selfhosted/.env','supabase/selfhosted/.env.staging']:
    p=Path(filename)
    if not p.exists():continue
    for line in p.read_text().splitlines():
        if '=' not in line or line.startswith('#'):continue
        name,value=line.split('=',1)
        if re.search('KEY|SECRET|PASSWORD|JWT',name) and value:text=text.replace(value,'[REDACTED]')
text=re.sub(r'[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}','[REDACTED_JWT]',text)
text=re.sub(r'([?&#](?:access_token|refresh_token|token|token_hash)=)[^&\s"\']+',r'\1[REDACTED]',text)
text=re.sub(r'("(?:access_token|refresh_token|token|token_hash)"\s*:\s*")[^"]+',r'\1[REDACTED]',text)
print(text[-12000:])
