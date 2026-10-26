export interface ActionDef {
  key: string;
  label: string;
  description?: string;
}

export interface ModuleDef {
  key: string;
  label: string;
  group: 'Main' | 'Master Data' | 'Operations' | 'Finance' | 'System';
  actions: ActionDef[];
}

export const PERMISSION_CATALOG: ModuleDef[] = [
  {
    key: 'dashboard',
    label: 'Dashboard Overview',
    group: 'Main',
    actions: [
      { key: 'view', label: 'View Dashboard' },
    ],
  },
  {
    key: 'periods',
    label: 'Events / Jastip Periods',
    group: 'Master Data',
    actions: [
      { key: 'view', label: 'View Events' },
      { key: 'create', label: 'Create Event' },
      { key: 'edit', label: 'Edit Event' },
      { key: 'delete', label: 'Delete Event' },
      { key: 'close', label: 'Close Event' },
    ],
  },
  {
    key: 'products',
    label: 'Products Catalog',
    group: 'Master Data',
    actions: [
      { key: 'view', label: 'View Products' },
      { key: 'create', label: 'Add Product' },
      { key: 'edit', label: 'Edit Product' },
      { key: 'delete', label: 'Delete Product' },
      { key: 'detail', label: 'View Product Details' },
      { key: 'export', label: 'Export Products' },
    ],
  },
  {
    key: 'customers',
    label: 'Customers & CRM',
    group: 'Master Data',
    actions: [
      { key: 'view', label: 'View Customers' },
      { key: 'create', label: 'Add Customer' },
      { key: 'edit', label: 'Edit Customer' },
      { key: 'delete', label: 'Delete Customer' },
      { key: 'detail', label: 'View Customer Details' },
      { key: 'export', label: 'Export Customers' },
    ],
  },
  {
    key: 'whatsapp-groups',
    label: 'Master WhatsApp Groups',
    group: 'Master Data',
    actions: [
      { key: 'view', label: 'View WhatsApp Groups' },
      { key: 'create', label: 'Create WhatsApp Group' },
      { key: 'edit', label: 'Edit WhatsApp Group' },
      { key: 'delete', label: 'Delete WhatsApp Group' },
    ],
  },
  {
    key: 'orders',
    label: 'Customer Orders',
    group: 'Operations',
    actions: [
      { key: 'view', label: 'View Orders' },
      { key: 'create', label: 'Create Order' },
      { key: 'edit', label: 'Edit Order' },
      { key: 'delete', label: 'Delete Order' },
      { key: 'detail', label: 'View Order Details' },
      { key: 'status', label: 'Update Status' },
      { key: 'export', label: 'Export Orders' },
    ],
  },
  {
    key: 'purchases',
    label: 'Shopper Purchases',
    group: 'Operations',
    actions: [
      { key: 'view', label: 'View Purchases' },
      { key: 'create', label: 'Create Purchase' },
      { key: 'edit', label: 'Edit Purchase' },
      { key: 'delete', label: 'Delete Purchase' },
      { key: 'detail', label: 'View Purchase Details' },
      { key: 'export', label: 'Export Purchases' },
    ],
  },
  {
    key: 'shipments',
    label: 'Delivery & Shipments',
    group: 'Operations',
    actions: [
      { key: 'view', label: 'View Shipments' },
      { key: 'create', label: 'Create Shipment' },
      { key: 'edit', label: 'Edit Shipment' },
      { key: 'delete', label: 'Delete Shipment' },
      { key: 'detail', label: 'View Shipment Details' },
      { key: 'dispatch', label: 'Dispatch / Tracking' },
    ],
  },
  {
    key: 'item-tracking',
    label: 'Item Tracking',
    group: 'Operations',
    actions: [
      { key: 'view', label: 'View Item Tracking' },
      { key: 'edit', label: 'Update Item Status' },
    ],
  },
  {
    key: 'shopping-list',
    label: 'Shopper List',
    group: 'Operations',
    actions: [
      { key: 'view', label: 'View Shopping List' },
      { key: 'purchase', label: 'Mark as Purchased' },
      { key: 'export', label: 'Export Shopping List' },
    ],
  },
  {
    key: 'invoices',
    label: 'Invoices & Billing',
    group: 'Finance',
    actions: [
      { key: 'view', label: 'View Invoices' },
      { key: 'create', label: 'Create Invoice' },
      { key: 'edit', label: 'Edit Invoice' },
      { key: 'delete', label: 'Delete Invoice' },
      { key: 'detail', label: 'View Invoice Details' },
      { key: 'send', label: 'Send WhatsApp / Email' },
      { key: 'download', label: 'Download PDF / Print' },
    ],
  },
  {
    key: 'payments',
    label: 'Payment History & Verification',
    group: 'Finance',
    actions: [
      { key: 'view', label: 'View Payments' },
      { key: 'create', label: 'Record Payment' },
      { key: 'verify', label: 'Verify Payment' },
      { key: 'delete', label: 'Delete Payment' },
    ],
  },
  {
    key: 'refunds',
    label: 'Customer Refunds',
    group: 'Finance',
    actions: [
      { key: 'view', label: 'View Refunds' },
      { key: 'request', label: 'Pilih Metode & Input Rekening Refund' },
      { key: 'execute', label: 'Kirim Dana & Upload Bukti Transfer' },
      { key: 'delete', label: 'Delete Refund' },
    ],
  },
  {
    key: 'expenses',
    label: 'Operational Expenses',
    group: 'Finance',
    actions: [
      { key: 'view', label: 'View Expenses' },
      { key: 'create', label: 'Record Expense' },
      { key: 'edit', label: 'Edit Expense' },
      { key: 'delete', label: 'Delete Expense' },
    ],
  },
  {
    key: 'finance',
    label: 'Cash Flow Overview',
    group: 'Finance',
    actions: [
      { key: 'view', label: 'View Cash Flow' },
      { key: 'export', label: 'Export Cash Flow' },
    ],
  },
  {
    key: 'summary',
    label: 'Summary & Fee Calculator',
    group: 'Finance',
    actions: [
      { key: 'view', label: 'View Summary' },
      { key: 'calculate', label: 'Configure Fees' },
    ],
  },
  {
    key: 'reports',
    label: 'Profit & Loss Reports',
    group: 'Finance',
    actions: [
      { key: 'view', label: 'View Reports' },
      { key: 'export', label: 'Export Reports' },
    ],
  },
  {
    key: 'users',
    label: 'User Management',
    group: 'System',
    actions: [
      { key: 'view', label: 'View Users' },
      { key: 'create', label: 'Create User' },
      { key: 'edit', label: 'Edit User' },
      { key: 'delete', label: 'Deactivate / Delete User' },
    ],
  },
  {
    key: 'roles',
    label: 'Roles & Permissions',
    group: 'System',
    actions: [
      { key: 'view', label: 'View Roles & Permissions' },
      { key: 'create', label: 'Create Role' },
      { key: 'edit', label: 'Update Role Permissions' },
      { key: 'delete', label: 'Delete Role' },
    ],
  },
  {
    key: 'settings',
    label: 'System Settings',
    group: 'System',
    actions: [
      { key: 'view', label: 'View Settings' },
      { key: 'edit', label: 'Modify Settings' },
    ],
  },
  {
    key: 'trash',
    label: 'Trash & Bin Recovery',
    group: 'System',
    actions: [
      { key: 'view', label: 'View Trash' },
      { key: 'restore', label: 'Restore Deleted Items' },
      { key: 'permanent_delete', label: 'Permanent Delete' },
    ],
  },
];
