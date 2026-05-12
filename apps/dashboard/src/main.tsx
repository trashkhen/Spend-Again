import React from 'react';
import ReactDOM from 'react-dom/client';

function App(): React.ReactElement {
  return <div>Spend Again?</div>;
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
