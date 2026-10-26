// Districts of the kids' city. Plain data, shared by server and client.
// Coordinates are world x/z; the plaza spawn sits at (32, 32).

export const DISTRICTS = [
  { id: 'park', name: 'Парк', x: 32, z: 52 },
]

export const DISTRICT_BY_ID = new Map(DISTRICTS.map((d) => [d.id, d]))
