export interface PriceLevelSnapshot {
  price: number;
  totalQuantity: number;
  orderCount: number;
}

export interface OrderBookSnapshot {
  ticker: string;
  bids: PriceLevelSnapshot[];
  asks: PriceLevelSnapshot[];
  timestamp: number;
}

export interface Trade {
  id: string;
  ticker: string;
  buyOrderId: string;
  sellOrderId: string;
  price: number;
  quantity: number;
  timestamp: number;
}

export interface OrderPlacedEvent {
  orderId: string;
  status: 'open' | 'filled' | 'partial';
}

export interface OrderCancelledEvent {
  orderId: string;
  status: 'cancelled';
}

export interface OrderCompletedEvent {
  orderId: string;
  status: 'filled';
}

export interface OrderPartialFillEvent {
  orderId: string;
  filledQty: number;
  remainingQty: number;
}

export interface ClobErrorEvent {
  message: string;
}

export interface PlaceOrderArgs {
  ticker: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
}
