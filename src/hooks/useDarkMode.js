import { useState, useMemo } from "react";
import { createMuiTheme } from "@material-ui/core/styles";
import Color from "color";
const defaultFontFamily = ["Maven Pro", "sans-serif"].join(",");
const primary = "#f2511c";

const useDarkMode = () => {
  const [isDarkMode, setDarkMode] = useState(true);
  const toggleDarkMode = () => setDarkMode(!isDarkMode);

  const muiTheme = useMemo(
    () =>
      createMuiTheme({
        typography: {
          fontFamily: defaultFontFamily,
        },
        palette: {
          type: isDarkMode ? "dark" : "light",
          primary: {
            light: Color(primary).lighten(0.95).string(),
            main: primary,
            dark: Color(primary).darken(0.5).string(),
          },
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
