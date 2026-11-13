-- Turns \newpage into a page break for HTML (print) and DOCX output.
function RawBlock(el)
  if el.text:match("^\\newpage") then
    if FORMAT:match("html") then
      return pandoc.RawBlock("html", '<div class="pagebreak"></div>')
    elseif FORMAT:match("docx") then
      return pandoc.RawBlock("openxml", '<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    else
      return {}
    end
  end
end
