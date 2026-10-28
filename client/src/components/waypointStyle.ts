export function waypointKind(index: number, count: number): 'start' | 'via' | 'finish' {
  return index === 0 ? 'start' : index === count - 1 ? 'finish' : 'via';
}
