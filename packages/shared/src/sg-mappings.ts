import type { Category, SubCategory } from './categories.js'

export type MappingEntry = {
  category: Category
  subCategory: SubCategory
}

// SG_ITEM_MAP: normalized merchant/item names → category mapping
// Keys are lowercase normalized forms of Singapore-specific merchants and items
export const SG_ITEM_MAP: Record<string, MappingEntry> = {
  // Supermarkets
  ntuc: { category: 'Groceries', subCategory: 'Supermarket' },
  fairprice: { category: 'Groceries', subCategory: 'Supermarket' },
  'ntuc fairprice': { category: 'Groceries', subCategory: 'Supermarket' },
  'cold storage': { category: 'Groceries', subCategory: 'Supermarket' },
  giant: { category: 'Groceries', subCategory: 'Supermarket' },
  shengsiong: { category: 'Groceries', subCategory: 'Supermarket' },
  'sheng siong': { category: 'Groceries', subCategory: 'Supermarket' },
  redmart: { category: 'Groceries', subCategory: 'Online' },

  // Convenience stores
  '7-eleven': { category: 'Groceries', subCategory: 'Convenience' },
  '7eleven': { category: 'Groceries', subCategory: 'Convenience' },
  cheers: { category: 'Groceries', subCategory: 'Convenience' },
  'watsons': { category: 'Health', subCategory: 'Pharmacy' },
  guardian: { category: 'Health', subCategory: 'Pharmacy' },

  // Ride-hailing / Transport
  grab: { category: 'Transport', subCategory: 'Grab' },
  gojek: { category: 'Transport', subCategory: 'Gojek' },
  'grab car': { category: 'Transport', subCategory: 'Grab' },
  grabfood: { category: 'Food', subCategory: 'Delivery' },
  'grab food': { category: 'Food', subCategory: 'Delivery' },
  'gojek food': { category: 'Food', subCategory: 'Delivery' },
  ryde: { category: 'Transport', subCategory: 'Taxi' },
  tada: { category: 'Transport', subCategory: 'Taxi' },
  comfort: { category: 'Transport', subCategory: 'Taxi' },
  comfortdelgro: { category: 'Transport', subCategory: 'Taxi' },

  // Public transport
  ezlink: { category: 'Transport', subCategory: 'MRT/Bus' },
  'ez-link': { category: 'Transport', subCategory: 'MRT/Bus' },
  simplygo: { category: 'Transport', subCategory: 'MRT/Bus' },
  mrt: { category: 'Transport', subCategory: 'MRT/Bus' },
  bus: { category: 'Transport', subCategory: 'MRT/Bus' },

  // Food delivery
  foodpanda: { category: 'Food', subCategory: 'Delivery' },
  'food panda': { category: 'Food', subCategory: 'Delivery' },
  deliveroo: { category: 'Food', subCategory: 'Delivery' },

  // Hawker / Local food
  'hawker centre': { category: 'Food', subCategory: 'Hawker' },
  hawker: { category: 'Food', subCategory: 'Hawker' },
  kopitiam: { category: 'Food', subCategory: 'Hawker' },
  foodcourt: { category: 'Food', subCategory: 'Hawker' },
  'food court': { category: 'Food', subCategory: 'Hawker' },

  // Retail / Shopping
  popular: { category: 'Shopping', subCategory: 'Books' },
  'popular bookstore': { category: 'Shopping', subCategory: 'Books' },
  daiso: { category: 'Shopping', subCategory: 'Home & Living' },
  'don don donki': { category: 'Shopping', subCategory: 'Home & Living' },
  dondondonki: { category: 'Shopping', subCategory: 'Home & Living' },
  donki: { category: 'Shopping', subCategory: 'Home & Living' },
  ikea: { category: 'Shopping', subCategory: 'Home & Living' },
  muji: { category: 'Shopping', subCategory: 'Home & Living' },
  uniqlo: { category: 'Shopping', subCategory: 'Clothing' },
  zara: { category: 'Shopping', subCategory: 'Clothing' },
  hm: { category: 'Shopping', subCategory: 'Clothing' },
  'h&m': { category: 'Shopping', subCategory: 'Clothing' },
  lazada: { category: 'Shopping', subCategory: 'Online Shopping' },
  shopee: { category: 'Shopping', subCategory: 'Online Shopping' },
  qoo10: { category: 'Shopping', subCategory: 'Online Shopping' },
  amazon: { category: 'Shopping', subCategory: 'Online Shopping' },

  // Telco / Utilities
  singtel: { category: 'Utilities', subCategory: 'Mobile' },
  starhub: { category: 'Utilities', subCategory: 'Mobile' },
  'm1': { category: 'Utilities', subCategory: 'Mobile' },
  circles: { category: 'Utilities', subCategory: 'Mobile' },
  'circles.life': { category: 'Utilities', subCategory: 'Mobile' },
  'sp services': { category: 'Utilities', subCategory: 'Electricity' },
  'sp group': { category: 'Utilities', subCategory: 'Electricity' },

  // Entertainment / Subscriptions
  netflix: { category: 'Entertainment', subCategory: 'Subscriptions' },
  spotify: { category: 'Entertainment', subCategory: 'Subscriptions' },
  'disney+': { category: 'Entertainment', subCategory: 'Subscriptions' },
  disneyplus: { category: 'Entertainment', subCategory: 'Subscriptions' },
  youtube: { category: 'Entertainment', subCategory: 'Subscriptions' },
  'youtube premium': { category: 'Entertainment', subCategory: 'Subscriptions' },
  shaw: { category: 'Entertainment', subCategory: 'Movies' },
  gv: { category: 'Entertainment', subCategory: 'Movies' },
  'golden village': { category: 'Entertainment', subCategory: 'Movies' },
  cathay: { category: 'Entertainment', subCategory: 'Movies' },

  // Health
  unity: { category: 'Health', subCategory: 'Pharmacy' },
  'unity pharmacy': { category: 'Health', subCategory: 'Pharmacy' },
  'polyclinic': { category: 'Health', subCategory: 'Clinic' },
  'singhealth': { category: 'Health', subCategory: 'Clinic' },
  nuhs: { category: 'Health', subCategory: 'Clinic' },

  // Finance
  dbs: { category: 'Finance', subCategory: 'Bank Fees' },
  ocbc: { category: 'Finance', subCategory: 'Bank Fees' },
  uob: { category: 'Finance', subCategory: 'Bank Fees' },
  cpf: { category: 'Finance', subCategory: 'CPF' },
  'cpf board': { category: 'Finance', subCategory: 'CPF' },

  // Housing
  hdb: { category: 'Housing', subCategory: 'Mortgage' },
  ura: { category: 'Housing', subCategory: 'Maintenance' },
}
