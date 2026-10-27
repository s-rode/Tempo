import mongoose from 'mongoose';

// Replace Apple-owned data atomically; sync never prunes Tempo-owned metadata.
const integrationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    permission: {
      type: String,
      enum: ['not_determined', 'granted', 'denied'],
      default: 'not_determined',
    },
    syncCalendarKey: { type: String, default: null },
    lastSuccessAtMs: { type: Number, default: null },
    error: { type: String, default: null },
    filter: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ match: 'any', rules: [{ kind: 'due_today' }, { kind: 'overdue' }] }),
    },
    lists: { type: [mongoose.Schema.Types.Mixed], default: [] },
    reminders: { type: [mongoose.Schema.Types.Mixed], default: [] },
    listContexts: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
const metadataSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    sourceId: { type: String, required: true },
    id: { type: String, required: true },
    estimatedMinutes: { type: Number, default: null, min: 1, max: 720 },
    focusContext: { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true }
);
metadataSchema.index({ userId: 1, sourceId: 1 }, { unique: true });
metadataSchema.index({ userId: 1, id: 1 }, { unique: true });
export const ReminderIntegrationModel = mongoose.model('ReminderIntegration', integrationSchema);
export const ReminderMetadataModel = mongoose.model('ReminderMetadata', metadataSchema);
