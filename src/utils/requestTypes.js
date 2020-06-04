export const setupRequestInfo = (requestType) => {
  switch (requestType) {
    case "portfolio":
      return {
        method: "get",
        path: "projects",
      };
    default:
      return null;
  }
};
