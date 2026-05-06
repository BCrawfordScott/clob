export type Ticker = string;

export type Side = 'buy' | 'sell';

export interface Trader {
  id: string;
  name: string;
}

export interface Order {
  id: string;
  traderId: string;
  ticker: Ticker;
  side: Side;
  price: number;
  quantity: number;
  remainingQty: number;
  timestamp: number;
}

export interface Trade {
  id: string;
  ticker: Ticker;
  buyOrderId: string;
  sellOrderId: string;
  price: number;
  quantity: number;
  timestamp: number;
}

export interface PriceLevelSnapshot {
  price: number;
  totalQuantity: number;
  orderCount: number;
}

export interface OrderBookSnapshot {
  ticker: Ticker;
  bids: PriceLevelSnapshot[];
  asks: PriceLevelSnapshot[];
  timestamp: number;
}
