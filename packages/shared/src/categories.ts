// Exactly 12 top-level categories for Singapore expense tracking
export type Category =
  | 'Food'
  | 'Groceries'
  | 'Transport'
  | 'Shopping'
  | 'Entertainment'
  | 'Health'
  | 'Education'
  | 'Travel'
  | 'Utilities'
  | 'Finance'
  | 'Housing'
  | 'Other'

export type SubCategory =
  // Food
  | 'Hawker'
  | 'Restaurant'
  | 'Cafe'
  | 'Fast Food'
  | 'Delivery'
  // Groceries
  | 'Supermarket'
  | 'Wet Market'
  | 'Online'
  | 'Convenience'
  // Transport
  | 'MRT/Bus'
  | 'Grab'
  | 'Gojek'
  | 'Taxi'
  | 'Petrol'
  | 'Parking'
  // Shopping
  | 'Clothing'
  | 'Electronics'
  | 'Home & Living'
  | 'Personal Care'
  | 'Online Shopping'
  // Entertainment
  | 'Movies'
  | 'Games'
  | 'Sports'
  | 'Events'
  | 'Subscriptions'
  // Health
  | 'Pharmacy'
  | 'Clinic'
  | 'Dental'
  | 'Optical'
  | 'Gym'
  // Education
  | 'Tuition'
  | 'Books'
  | 'Courses'
  | 'School Fees'
  // Travel
  | 'Flights'
  | 'Hotels'
  | 'Tours'
  | 'Travel Insurance'
  // Utilities
  | 'Electricity'
  | 'Water'
  | 'Internet'
  | 'Mobile'
  | 'Cable TV'
  // Finance
  | 'Insurance'
  | 'Investment'
  | 'Loan Repayment'
  | 'Bank Fees'
  | 'CPF'
  // Housing
  | 'Rent'
  | 'Mortgage'
  | 'Maintenance'
  | 'Renovation'
  | 'Furniture'
  // Other (shared fallback)
  | 'Other'

export const CATEGORIES: readonly Category[] = [
  'Food',
  'Groceries',
  'Transport',
  'Shopping',
  'Entertainment',
  'Health',
  'Education',
  'Travel',
  'Utilities',
  'Finance',
  'Housing',
  'Other',
] as const

export const CATEGORY_MAP: Record<Category, readonly SubCategory[]> = {
  Food: ['Hawker', 'Restaurant', 'Cafe', 'Fast Food', 'Delivery', 'Other'],
  Groceries: ['Supermarket', 'Wet Market', 'Online', 'Convenience', 'Other'],
  Transport: ['MRT/Bus', 'Grab', 'Gojek', 'Taxi', 'Petrol', 'Parking', 'Other'],
  Shopping: ['Clothing', 'Electronics', 'Home & Living', 'Personal Care', 'Online Shopping', 'Other'],
  Entertainment: ['Movies', 'Games', 'Sports', 'Events', 'Subscriptions', 'Other'],
  Health: ['Pharmacy', 'Clinic', 'Dental', 'Optical', 'Gym', 'Other'],
  Education: ['Tuition', 'Books', 'Courses', 'School Fees', 'Other'],
  Travel: ['Flights', 'Hotels', 'Tours', 'Travel Insurance', 'Other'],
  Utilities: ['Electricity', 'Water', 'Internet', 'Mobile', 'Cable TV', 'Other'],
  Finance: ['Insurance', 'Investment', 'Loan Repayment', 'Bank Fees', 'CPF', 'Other'],
  Housing: ['Rent', 'Mortgage', 'Maintenance', 'Renovation', 'Furniture', 'Other'],
  Other: ['Other'],
}
