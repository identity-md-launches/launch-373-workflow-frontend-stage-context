import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadDeployment } from './config';
import { errorMessage } from './math';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<main className="startup"><p className="eyebrow">Rebate / Sepolia</p><h1>Connecting the dots.</h1><p role="status">Loading and verifying the deployment configuration…</p></main>);
loadDeployment().then(runtime => root.render(<App runtime={runtime} />)).catch(error => root.render(<main className="startup"><p className="eyebrow">Rebate</p><h1>Unable to load the pool.</h1><p role="alert">{errorMessage(error)}</p><button onClick={() => window.location.reload()}>Reload configuration</button></main>));
