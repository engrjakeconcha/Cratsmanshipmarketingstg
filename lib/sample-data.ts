import type { DashboardRow } from "@/lib/dashboard";

const BASE_DATA: Array<{
  location: string;
  service: string;
  leads: number;
  booked: number;
  canceled: number;
  spend: number;
}> = [
  { location: "Dallas", service: "Kitchens", leads: 22, booked: 9, canceled: 2, spend: 4210 },
  { location: "Dallas", service: "Bathrooms", leads: 18, booked: 7, canceled: 1, spend: 3550 },
  { location: "Dallas", service: "Foundation", leads: 14, booked: 5, canceled: 1, spend: 3025 },
  { location: "San Diego", service: "Kitchens", leads: 19, booked: 8, canceled: 2, spend: 4460 },
  { location: "San Diego", service: "Bathrooms", leads: 16, booked: 6, canceled: 1, spend: 3180 },
  { location: "San Diego", service: "Decks", leads: 13, booked: 4, canceled: 0, spend: 2115 },
  { location: "San Diego", service: "ADU", leads: 11, booked: 4, canceled: 1, spend: 3980 },
  {
    location: "San Diego",
    service: "Garage Conversion",
    leads: 9,
    booked: 3,
    canceled: 1,
    spend: 2660,
  },
  { location: "San Diego", service: "Backyard", leads: 12, booked: 5, canceled: 1, spend: 2410 },
];

export function getSampleDashboardRows(): DashboardRow[] {
  const today = new Date();
  const rows: DashboardRow[] = [];

  for (let dayOffset = 0; dayOffset < 56; dayOffset += 1) {
    const currentDate = new Date(today);
    currentDate.setDate(today.getDate() - dayOffset);
    const isoDate = currentDate.toISOString().slice(0, 10);

    BASE_DATA.forEach((entry, index) => {
      const wave = ((dayOffset + 3) * (index + 5)) % 7;
      const leads = Math.max(0, entry.leads - (wave % 3));
      const booked = Math.max(0, entry.booked - (wave % 2));
      const canceled = Math.min(booked, entry.canceled + (wave % 2 === 0 ? 0 : 1));
      const spend = Math.max(200, entry.spend - wave * 45 + index * 10);

      rows.push({
        date: isoDate,
        location: entry.location,
        service: entry.service,
        leads,
        booked,
        canceled,
        spend,
      });
    });
  }

  return rows;
}
