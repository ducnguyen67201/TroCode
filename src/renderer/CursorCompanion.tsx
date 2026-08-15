import cursorBuddyUrl from '../assets/tro-cursor-buddy.png';

export function CursorCompanion() {
  return (
    <div className="cursor-companion" role="img" aria-label="TroCode companion">
      <img alt="" draggable={false} src={cursorBuddyUrl} />
    </div>
  );
}
