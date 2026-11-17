# Veridex

Web UI for a deepfake face detector (EfficientNet-B0, scored on face crops from photos and videos).

## Run locally
1. Start the model server (separate project, `app.py`): `uvicorn app:app --host 127.0.0.1 --port 8000`
2. In this folder: `npm install`, then `npm run dev`, then open http://localhost:5173

Set `VITE_API_URL` in a `.env` file to use a different server address.

## Accuracy
- Held-out photos: AUC 0.998
- Unseen video frames: AUC 0.84 (catches about 7 in 10 fakes, wrongly flags about 2 in 10 real faces)
- A screening aid, not proof. One face at a time; new generators can fool it.