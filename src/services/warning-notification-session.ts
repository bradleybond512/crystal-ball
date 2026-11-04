let activeOwners = 0;

export function acquireWarningSession(onLastOwner: () => void): () => void {
  activeOwners++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeOwners--;
    if (activeOwners === 0) onLastOwner();
  };
}
