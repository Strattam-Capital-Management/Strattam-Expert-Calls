import type { DiligenceQuestion } from '../types';

// Standard commercial due-diligence question framework, used whenever the user doesn't supply
// their own diligence questions on POST /run/start. Also served directly by GET /questions/default.
export const DEFAULT_DILIGENCE_QUESTIONS: DiligenceQuestion[] = [
  {
    id: 'q1',
    text: "How defensible is the company's market and competitive position, and who is really gaining or losing share?",
    topics: ['market position', 'competition', 'share'],
  },
  {
    id: 'q2',
    text: 'What do customer retention patterns and unit economics actually look like at the cohort level?',
    topics: ['retention', 'unit economics', 'customers'],
  },
  {
    id: 'q3',
    text: 'How effective is the go-to-market motion (sales, marketing, channel/partners) relative to peers?',
    topics: ['go-to-market', 'sales', 'marketing', 'channel'],
  },
  {
    id: 'q4',
    text: 'How differentiated is the product/technology, and how durable is that edge likely to be?',
    topics: ['product', 'technology', 'differentiation'],
  },
  {
    id: 'q5',
    text: 'How strong is the management team and organization, and where are the key-person risks?',
    topics: ['management', 'organization', 'talent'],
  },
  {
    id: 'q6',
    text: 'What regulatory or compliance risks could materially affect the business?',
    topics: ['regulatory', 'compliance', 'risk'],
  },
  {
    id: 'q7',
    text: 'How resilient is the supply chain, and how concentrated is supplier/vendor risk?',
    topics: ['supply chain', 'sourcing', 'vendors'],
  },
  {
    id: 'q8',
    text: 'What is the credible growth/expansion strategy, and what could realistically derail it?',
    topics: ['growth', 'expansion', 'strategy'],
  },
];
