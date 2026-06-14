import { Response } from 'express';
import { logger } from '../utils/logger';
import {
  sendStepUpProof, StepUpError,
  type StepUpAction, type StepUpChannel,
} from '../utils/stepUp';
import type { AuthRequest } from '../middleware/auth';

// POST /auth/step-up/send-proof — dispatches a step-up proof code to an
// EXISTING factor so the caller can prove control of it before changing a
// contact channel. Generic over the sensitive action (change_phone /
// change_email) and the delivery channel (sms → current verified phone,
// email → email on file). TOTP needs no send — the client submits an
// authenticator code directly to the change endpoint.
//
// Authenticated + rate-limited at the route layer. Returns only a masked
// destination, never the code.
export async function sendStepUpProofHandler(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const schoolId = req.user!.schoolId;
  const action = req.body?.action as StepUpAction;
  const channel = req.body?.channel as StepUpChannel;

  try {
    const result = await sendStepUpProof({ schoolId, userId, action, channel });
    res.status(202).json({ channel: result.channel, sentTo: result.sentTo });
  } catch (err) {
    if (err instanceof StepUpError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    logger.error('sendStepUpProofHandler failed', { error: (err as Error).message });
    res.status(500).json({ error: 'Could not send verification code.' });
  }
}
