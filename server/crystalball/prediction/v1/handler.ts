import type { PredictionServiceHandler } from '../../../../src/generated/server/crystalball/prediction/v1/service_server';

import { listPredictionMarkets } from './list-prediction-markets';

export const predictionHandler: PredictionServiceHandler = {
  listPredictionMarkets,
};
