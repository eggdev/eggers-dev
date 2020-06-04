import { createMuiTheme } from "@material-ui/core/styles";
const defaultFontFamily = ["Maven Pro", "sans-serif"].join(",");

const Theme = createMuiTheme({
  typography: {
    fontFamily: defaultFontFamily,
  },
  overrides: {},
});

export default Theme;
