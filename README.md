# DeepVerify - ZeroTrustFramework

DeepVerify is a full-stack application composed of a backend and a frontend.

## Project Structure

- `frontend/`: The frontend application built with Vite and React (TypeScript).
- `backend/`: The backend API, written in Python.
- `docker-compose.yml`: For running services via Docker.

## Getting Started

### Prerequisites
- Node.js & npm (for frontend)
- Python 3.x (for backend)
- Docker (optional, for running with containers)

### Frontend
To run the frontend development server:
```bash
cd frontend
npm install
npm run dev
```

### Backend
To run the backend development server:
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows use: .venv\Scripts\activate
pip install -r requirements.txt
# Run the application (command depends on the framework used, e.g., fastapi or flask)
```

## License

This project is licensed under the MIT License.
