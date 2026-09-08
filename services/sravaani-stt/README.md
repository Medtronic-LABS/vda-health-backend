# VDA SraVaani STT service

Private persistent ASR service used only by the VDA backend. It loads
`ARTPARK-IISc/SraVaani-0.5-live` once at startup and exposes `POST /transcribe`
on `127.0.0.1:8001` by default.

Prerequisites: Python 3.10+, FFmpeg on `PATH`, and a Hugging Face account that
has accepted the model's gated access terms.

```powershell
cd C:\Users\paras\OneDrive\Desktop\VDA-Application\vda\services\sravaani-stt
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:HF_TOKEN = '<your Hugging Face token>'
uvicorn app:app --host 127.0.0.1 --port 8001
```

Recordings are only written to a temporary directory for FFmpeg normalization
to 16 kHz mono and are deleted before the response returns.
