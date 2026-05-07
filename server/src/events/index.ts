import { Trade, OrderBookSnapshot } from '../domain/models';

export interface OrderBookUpdatedPayload {
  ticker: string;
  snapshot: OrderBookSnapshot;
}

export interface OrderCompletedPayload {
  orderId: string;
  traderId: string;
}

// TradeExecutedPayload is Trade directly — the trade object is emitted as-is.
export type TradeExecutedPayload = Trade;

export interface OrderPartialFillEvent {
  orderId: string;
  traderId: string;
  filledQty: number;
  remainingQty: number;
}

export const Events = {
  TRADE_EXECUTED: 'trade.executed',
  ORDERBOOK_UPDATED: 'orderbook.updated',
  ORDER_COMPLETED: 'order.completed',
  ORDER_PARTIAL_FILL: 'order.partialFill',
} as const;
