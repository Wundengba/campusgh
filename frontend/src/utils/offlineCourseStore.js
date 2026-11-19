const DATABASE_NAME = "campus-ghana-course-cache";
const DATABASE_VERSION = 1;
const COURSE_STORE = "courses";

const openDatabase = () => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) {
    reject(new Error("Offline course storage is not supported in this browser."));
    return;
  }

  const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(COURSE_STORE)) {
      request.result.createObjectStore(COURSE_STORE, { keyPath: "courseId" });
    }
  };
  request.onerror = () => reject(request.error || new Error("Offline storage could not be opened."));
  request.onsuccess = () => resolve(request.result);
});

export const saveOfflineCourse = async (record) => {
  const courseId = String(record?.course?.id ?? "");
  if (!courseId) throw new Error("A course ID is required for offline storage.");

  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(COURSE_STORE, "readwrite");
      transaction.objectStore(COURSE_STORE).put({
        ...record,
        courseId,
        savedAt: new Date().toISOString(),
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Course could not be saved offline."));
      transaction.onabort = () => reject(transaction.error || new Error("Offline course save was cancelled."));
    });
  } finally {
    database.close();
  }
};

export const listOfflineCourses = async () => {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(COURSE_STORE, "readonly");
      const request = transaction.objectStore(COURSE_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error("Saved offline courses could not be read."));
      transaction.onerror = () => reject(transaction.error || new Error("Saved offline courses could not be read."));
    });
  } finally {
    database.close();
  }
};

export const removeOfflineCourse = async (courseId) => {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(COURSE_STORE, "readwrite");
      transaction.objectStore(COURSE_STORE).delete(String(courseId));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Offline course could not be removed."));
      transaction.onabort = () => reject(transaction.error || new Error("Offline course removal was cancelled."));
    });
  } finally {
    database.close();
  }
};
