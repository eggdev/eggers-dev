import { useState, useMemo } from "react";
import { useMediaQuery } from "@material-ui/core";
import { createMuiTheme } from "@material-ui/core/styles";
import Theme from "../utils/Theme";

const useDarkMode = () => {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const [isDarkMode, setDarkMode] = useState(!prefersDarkMode);
  const toggleDarkMode = () => setDarkMode(!isDarkMode);

  const muiTheme = useMemo(
    () =>
      createMuiTheme({
        ...Theme,
        palette: {
          type: isDarkMode ? "dark" : "light",
        },
      }),
    [isDarkMode]
  );

  return {
    muiTheme,
    isDarkMode,
    toggleDarkMode,
  };
};

export default useDarkMode;
