import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { ActiveWindowEventModel } from '../models/activeWindowEvent';
import { ClassifierFeedbackModel } from '../models/classifierFeedback';

dotenv.config({ path: '.env.local' });
dotenv.config();

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tempo_local';
await mongoose.connect(uri);
try {
  const [feedback, events] = await Promise.all([
    ClassifierFeedbackModel.find({ classifierVersion: 'factored-relation-v2' }).lean(),
    ActiveWindowEventModel.find({ classificationLatencyMs: { $ne: null } })
      .select('classificationStatus classificationLatencyMs')
      .lean(),
  ]);
  const latencies = events
    .map((event) => Number(event.classificationLatencyMs))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const p = (value: number) =>
    latencies.length ? latencies[Math.floor((latencies.length - 1) * value)] : null;
  const technicalFailures = events.filter((event) =>
    ['invalid_response', 'ollama_unavailable', 'ocr_unavailable'].includes(
      String(event.classificationStatus || '')
    )
  ).length;
  const changed = feedback.filter(
    (item) => item.originalCategoryId !== item.correctedCategoryId
  ).length;
  console.log(
    JSON.stringify(
      {
        classifierVersion: 'factored-relation-v2',
        labeledCorrections: feedback.length,
        correctionAgreement: feedback.length ? (feedback.length - changed) / feedback.length : null,
        technicalFailures,
        evaluatedEvents: events.length,
        latencyMs: { p50: p(0.5), p95: p(0.95) },
        note:
          feedback.length < 20
            ? 'Collect more corrections before treating agreement as representative.'
            : undefined,
      },
      null,
      2
    )
  );
} finally {
  await mongoose.disconnect();
}
