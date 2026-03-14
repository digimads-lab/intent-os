import { createApp } from './server';

const PORT = parseInt(process.env.STUB_PORT ?? '8888', 10);

const app = createApp();

app.listen(PORT, () => {
  console.log(`Claude API Stub running at http://localhost:${PORT}`);
});
