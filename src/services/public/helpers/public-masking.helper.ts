export function maskName(name: string): string {
  if (!name) return 'Customer';
  const parts = name.trim().split(/\s+/);
  return parts
    .map((p) => {
      if (p.length <= 2) return p[0] + '*';
      return p[0] + '*'.repeat(Math.max(1, p.length - 2)) + p[p.length - 1];
    })
    .join(' ');
}

export function maskPhone(phone: string): string {
  if (!phone) return '-';
  const clean = phone.replace(/\D/g, '');
  if (clean.length < 8) return clean.slice(0, 3) + '****';
  return clean.slice(0, 4) + '****' + clean.slice(-3);
}

export function maskAddress(address?: string | null, city?: string | null): string {
  if (city && city.trim()) {
    return `${city.trim()}, Indonesia`;
  }
  if (!address) return 'Kota Pengiriman Terkonfirmasi';
  const parts = address.split(',');
  if (parts.length > 1) {
    return parts[parts.length - 1].trim();
  }
  return address.slice(0, 10) + '...';
}
