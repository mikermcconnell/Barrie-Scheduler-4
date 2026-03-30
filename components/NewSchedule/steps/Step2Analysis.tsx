import React from 'react';
import { Step2PlanningReviewPanel } from '../step2/Step2PlanningReviewPanel';

export type Step2Props = React.ComponentProps<typeof Step2PlanningReviewPanel>;

export const Step2Analysis: React.FC<Step2Props> = (props) => (
    <Step2PlanningReviewPanel {...props} />
);
