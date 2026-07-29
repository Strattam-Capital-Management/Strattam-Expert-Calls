import { Router } from 'express';
import { DEFAULT_DILIGENCE_QUESTIONS } from '../prompts/defaultQuestions';

export const questionsRouter = Router();

questionsRouter.get('/questions/default', (_req, res) => {
  res.json({ questions: DEFAULT_DILIGENCE_QUESTIONS });
});
